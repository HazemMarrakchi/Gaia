package com.gaia.simulator.domain;

import com.gaia.simulator.engine.SimModule;
import com.gaia.simulator.engine.TickContext;
import com.gaia.simulator.domain.event.SimEvent;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Energy & Climate module. Entities: power plants, grid nodes, batteries,
 * weather cells. A heatwave raises load and pushes price; transport demand
 * adds load via a cross-domain coupling.
 */
public final class EnergyModule implements SimModule {

    private final Deque<SimEvent> events = new ArrayDeque<>();

    private final List<Plant> plants;
    private final List<GridNode> grid;
    /** Distinct region keys present in this world's grid. */
    private final List<String> regions;
    /** Per-region heatwave intensity (0..1) — heatwaves are regional events. */
    private final Map<String, Double> heatwave = new HashMap<>();

    public EnergyModule(List<Plant> plants, List<GridNode> grid) {
        this.plants = plants;
        this.grid = grid;
        this.regions = grid.stream().map(g -> g.region).distinct().sorted().toList();
        regions.forEach(r -> heatwave.put(r, 0.0));
    }

    @Override
    public EnergyModule copy() {
        List<Plant> copyPlants = plants.stream()
                .map(p -> new Plant(p.name, p.capacityMw, p.efficiency, p.type, p.region, p.status))
                .toList();
        List<GridNode> copyGrid = grid.stream()
                .map(g -> new GridNode(g.id, g.region, g.baseLoadMw))
                .toList();
        EnergyModule m = new EnergyModule(copyPlants, copyGrid);
        m.heatwave.putAll(heatwave);
        return m;
    }

    @Override
    public Domain domain() {
        return Domain.ENERGY;
    }

    @Override
    public void tick(TickContext ctx) {
        // 0. Cross-domain coupling: a global crisis (the energy/cities/transport
        //    severity EMA propagated through TickContext.externalShock by the
        //    engine) triggers energy-conservation brownouts and a brownout event.
        double shock = ctx.externalShock();
        if (shock > 0.1 && !regions.isEmpty()) {
            emit(ctx, "BROWNOUT", "global", Math.min(1.0, shock), "{}");
        }
        // 1. Weather: heatwaves build and decay per region (mean-reverting walk).
        if (ctx.rng().nextDouble() < 0.08 && !regions.isEmpty()) {
            String region = regions.get((int) (ctx.rng().nextDouble() * regions.size()));
            heatwave.merge(region, ctx.rng().nextGaussian() * 0.15,
                    (old, delta) -> Math.max(0.0, Math.min(1.0, old + delta)));
        }
        regions.forEach(r -> heatwave.computeIfPresent(r, (k, v) -> v * 0.995));

        // 2. Per-region demand (weather + noise) and available generation.
        Map<String, Double> demandByRegion = new HashMap<>();
        Map<String, Double> capacityByRegion = new HashMap<>();
        double demand = 0;
        for (String r : regions) {
            double heat = heatwave.getOrDefault(r, 0.0);
            double d = grid.stream().filter(n -> n.region.equals(r))
                    .mapToDouble(n -> n.baseLoadMw).sum()
                    * (1.0 + 0.5 * heat)
                    * (1.0 + 0.04 * ctx.rng().nextGaussian());
            demandByRegion.put(r, d);
            demand += d;
        }
        for (Plant p : plants) {
            double available = p.status == Plant.Status.OUTAGE ? 0.0 : p.capacityMw * p.efficiency;
            capacityByRegion.merge(p.region, available, Double::sum);
        }

        // 3. Dispatch: plant outages are regional incidents.
        for (Plant p : plants) {
            if (p.status == Plant.Status.OPERATIONAL && ctx.rng().nextDouble() < 0.0005) {
                p.status = Plant.Status.OUTAGE;
                emit(ctx, "PLANT_OUTAGE", p.region, 0.9,
                        "{\"plant\":\"%s\"}".formatted(p.name));
            }
        }

        // 4. Regional hot-spots: every strained region reports GRID_STRESS.
        for (String r : regions) {
            double d = demandByRegion.get(r);
            double shortage = Math.max(0.0, d - capacityByRegion.getOrDefault(r, 0.0));
            if (d > 0 && shortage > 0.05 * d) {
                emit(ctx, "GRID_STRESS", r, Math.min(1.0, shortage / d), "{}");
            }
        }

        // 5. World-wide balance + price reacts to total shortage/heat.
        double generated = capacityByRegion.values().stream().mapToDouble(Double::doubleValue).sum();
        double shortage = Math.max(0.0, demand - generated);
        double price = basePrice() * (1.0 + shortage * 0.5
                + heatwave.values().stream().mapToDouble(Double::doubleValue).average().orElse(0) * 0.3);

        if (shortage > 0.05 * demand) {
            emit(ctx, "GRID_STRESS", "global", Math.min(1.0, shortage / demand), "{}");
        }
        final double totalDemand = demand;
        double totalBaseLoad = grid.stream().mapToDouble(g -> g.baseLoadMw).sum();
        grid.forEach(n -> updateLoadPrice(n, demandByRegion.getOrDefault(n.region, totalDemand),
                price, totalBaseLoad));
    }

    private void updateLoadPrice(GridNode node, double demand, double price, double totalBaseLoad) {
        node.lastLoadMw = demand * (node.baseLoadMw / totalBaseLoad);
        node.lastPrice = price;
    }

    private double basePrice() {
        return grid.stream().mapToDouble(n -> n.lastPrice == 0 ? 45.0 : n.lastPrice).average()
                .orElse(45.0);
    }

    private void emit(TickContext ctx, String type, String region, double severity, String payload) {
        events.add(SimEvent.of(ctx.tick(), ctx.timestamp(), Domain.ENERGY, type, region,
                severity, payload));
    }

    @Override
    public Map<String, Object> state() {
        return Map.of("heatwaveIntensity", heatwave.values().stream()
                        .mapToDouble(Double::doubleValue).max().orElse(0),
                "heatwaveByRegion", Map.copyOf(heatwave),
                "plants", plants.stream().map(Plant::snapshot).toList(),
                "grid", grid.stream().map(GridNode::snapshot).toList());
    }

    @Override
    public void applyPerturbation(String type, Map<String, Object> params) {
        switch (type.toLowerCase()) {
            case "heatwave", "heatwave_eu_july" -> {
                // Regional by nature: defaults to the documented EU July heatwave.
                String region = String.valueOf(params.getOrDefault("region", "eu-west"));
                if (!regions.contains(region)) {
                    region = regions.isEmpty() ? "eu-west" : regions.get(0);
                }
                heatwave.put(region, 0.85);
            }
            case "global_heatwave" -> regions.forEach(r -> heatwave.put(r, 0.85));
            case "close_plant", "plant_outage", "outage" -> {
                String name = (String) params.getOrDefault("plant", plants.isEmpty() ? null
                        : plants.get(0).name);
                plants.stream().filter(p -> p.name.equals(name)).forEach(p -> p.status = Plant.Status.OUTAGE);
            }
            default -> { /* unknown perturbation ignored (test-friendly) */ }
        }
    }

    @Override
    public List<SimEvent> drainEvents() {
        List<SimEvent> out = new ArrayList<>(events);
        events.clear();
        return out;
    }

    // --- entities -------------------------------------------------------

    public static final class Plant {
        public final String name;
        public final double capacityMw;
        public final double efficiency;
        public final PlantType type;
        public final String region;
        public Status status;

        public enum PlantType { SOLAR, WIND, THERMAL, BACKUP }
        public enum Status { OPERATIONAL, OUTAGE }
        public Plant(String name, double capacityMw, double efficiency, PlantType type, String region) {
            this(name, capacityMw, efficiency, type, region, Status.OPERATIONAL);
        }
        public Plant(String name, double capacityMw, double efficiency, PlantType type,
                     String region, Status status) {
            this.name = name;
            this.capacityMw = capacityMw;
            this.efficiency = efficiency;
            this.type = type;
            this.region = region;
            this.status = status;
        }
        Map<String, Object> snapshot() {
            return Map.of("name", name, "capacityMw", capacityMw, "efficiency", efficiency,
                    "type", type.name(), "region", region, "status", status.name());
        }
    }

    public static final class GridNode {
        public final String id;
        public final String region;
        public final double baseLoadMw;
        private double lastLoadMw;
        private double lastPrice;

        public GridNode(String id, String region, double baseLoadMw) {
            this.id = id;
            this.region = region;
            this.baseLoadMw = baseLoadMw;
        }

        Map<String, Object> snapshot() {
            return Map.of("id", id, "region", region, "baseLoadMw", baseLoadMw,
                    "lastLoadMw", lastLoadMw, "lastPrice", lastPrice);
        }
    }
}