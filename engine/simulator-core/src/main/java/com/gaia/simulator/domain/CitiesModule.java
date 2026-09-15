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
 * Cities module. Entities: districts, buildings, hospitals, water tanks.
 * Reacts to energy grid stress (curtailment) and heatwave-driven hospital load.
 */
public final class CitiesModule implements SimModule {

    private final Deque<SimEvent> events = new ArrayDeque<>();
    private final List<District> districts;
    /** Distinct region keys present in this world's districts. */
    private final List<String> regions;
    /** Per-region heatwave intensity (0..1) — mirrors the energy module. */
    private final Map<String, Double> heatwave = new HashMap<>();

    public CitiesModule(List<District> districts) {
        this.districts = districts;
        this.regions = districts.stream().map(d -> d.region).distinct().sorted().toList();
        regions.forEach(r -> heatwave.put(r, 0.0));
    }

    @Override
    public CitiesModule copy() {
        List<District> copyDistricts = districts.stream()
                .map(d -> {
                    District copy = new District(d.id, d.region, d.population, d.basePowerDraw,
                            d.gridCapacity, d.inflowPerTick, d.beds);
                    copy.waterLevel = d.waterLevel;
                    copy.hospitalOccupancy = d.hospitalOccupancy;
                    return copy;
                })
                .toList();
        CitiesModule m = new CitiesModule(copyDistricts);
        m.heatwave.putAll(heatwave);
        return m;
    }

    @Override
    public Domain domain() {
        return Domain.CITIES;
    }

    @Override
    public void tick(TickContext ctx) {
        // Heatwaves track the energy module's regional weather (coarser walk).
        if (ctx.rng().nextDouble() < 0.05 && !regions.isEmpty()) {
            String region = regions.get((int) (ctx.rng().nextDouble() * regions.size()));
            heatwave.merge(region, ctx.rng().nextGaussian() * 0.12,
                    (old, delta) -> Math.max(0.0, Math.min(1.0, old + delta)));
        }
        regions.forEach(r -> heatwave.computeIfPresent(r, (k, v) -> v * 0.995));

        double strain = 0;
        double hospitalLoad = 0;
        double waterShortage = 0;
        Map<String, Double> strainByRegion = new HashMap<>();
        Map<String, Integer> districtsByRegion = new HashMap<>();

        for (District d : districts) {
            double districtHeat = heatwave.getOrDefault(d.region, 0.0);
            double demandFactor = 1.0 + 0.3 * districtHeat;
            double powerDraw = d.basePowerDraw * demandFactor;
            double waterDraw = d.population * (0.4 + 0.5 * districtHeat);

            if (d.waterLevel < waterDraw) {
                waterShortage += waterDraw - d.waterLevel;
                d.waterLevel = 0;
            } else {
                d.waterLevel -= waterDraw;
            }
            d.waterLevel += d.inflowPerTick;

            hospitalLoad += d.hospitalOccupancy * 0.6 + districtHeat * d.beds;
            double districtStrain = 0.4 * districtHeat
                    + Math.max(0.0, powerDraw - d.gridCapacity) / d.gridCapacity;
            strain += districtStrain;
            strainByRegion.merge(d.region, districtStrain, Double::sum);
            districtsByRegion.merge(d.region, 1, Integer::sum);
        }

        // Regional hot-spots: every strained region reports CITY_STRAIN.
        for (String r : regions) {
            int count = districtsByRegion.getOrDefault(r, 0);
            double regionStrain = strainByRegion.getOrDefault(r, 0.0);
            if (count > 0 && regionStrain > count * 0.6) {
                emit(ctx, "CITY_STRAIN", r, Math.min(1.0, regionStrain / count), "{}");
            }
        }

        if (strain > districts.size() * 0.6) {
            emit(ctx, "CITY_STRAIN", "global", Math.min(1.0, strain / districts.size()), "{}");
        }
        if (waterShortage > 0) {
            emit(ctx, "WATER_SHORTAGE", "global", Math.min(1.0, waterShortage / 1_000_000), "{}");
        }
        if (hospitalLoad > districts.size() * 100) {
            emit(ctx, "HOSPITAL_LOAD", "global", Math.min(1.0, hospitalLoad / (districts.size() * 200)), "{}");
        }
    }

    private void emit(TickContext ctx, String type, String region, double severity, String payload) {
        events.add(SimEvent.of(ctx.tick(), ctx.timestamp(), Domain.CITIES, type, region, severity, payload));
    }

    @Override
    public Map<String, Object> state() {
        return Map.of("heatwave", heatwave.values().stream()
                        .mapToDouble(Double::doubleValue).max().orElse(0),
                "heatwaveByRegion", Map.copyOf(heatwave),
                "districts", districts.stream().map(District::snapshot).toList());
    }

    @Override
    public void applyPerturbation(String type, Map<String, Object> params) {
        switch (type.toLowerCase()) {
            case "heatwave", "heatwave_eu_july" -> {
                String region = String.valueOf(params.getOrDefault("region", "eu-west"));
                if (!regions.contains(region)) {
                    region = regions.isEmpty() ? "eu-west" : regions.get(0);
                }
                heatwave.put(region, 0.8);
            }
            case "strain", "global_heatwave" -> regions.forEach(r -> heatwave.put(r, 0.8));
            case "water_shortage", "outage" -> districts.forEach(d -> d.waterLevel *= 0.4);
            default -> { /* no-op */ }
        }
    }

    @Override
    public List<SimEvent> drainEvents() {
        List<SimEvent> out = new ArrayList<>(events);
        events.clear();
        return out;
    }

    public static final class District {
        final String id;
        final String region;
        final long population;
        final double basePowerDraw;
        final double gridCapacity;
        final double inflowPerTick;
        final int beds;
        double waterLevel;
        double hospitalOccupancy;

        public District(String id, String region, long population, double basePowerDraw,
                        double gridCapacity, double inflowPerTick, int beds) {
            this.id = id;
            this.region = region;
            this.population = population;
            this.basePowerDraw = basePowerDraw;
            this.gridCapacity = gridCapacity;
            this.inflowPerTick = inflowPerTick;
            this.beds = beds;
            this.waterLevel = 1_000_000;
        }

        Map<String, Object> snapshot() {
            return Map.of("id", id, "region", region, "population", population, "waterLevel", waterLevel,
                    "hospitalOccupancy", hospitalOccupancy);
        }
    }
}