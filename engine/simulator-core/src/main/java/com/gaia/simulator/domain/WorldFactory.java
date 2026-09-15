package com.gaia.simulator.domain;

import com.gaia.simulator.domain.CitiesModule.District;
import com.gaia.simulator.domain.EnergyModule.GridNode;
import com.gaia.simulator.domain.EnergyModule.Plant;
import com.gaia.simulator.domain.FinanceModule.Bank;
import com.gaia.simulator.domain.TransportModule.Vehicle;
import com.gaia.simulator.engine.SimulationState;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.IntStream;

/**
 * Builds a ready-to-run {@link SimulationState} with a deterministic world:
 * regional grid tied to districts, transport operators, banks. Entity counts
 * are configurable so demos can scale from a handful of entities to 1M+.
 */
public final class WorldFactory {

    public record WorldConfig(int districts, int plants, int gridNodes,
                              int vehicles, int banks) {
        /** Distributed budget where the total entity count ≈ {@code n}. */
        public static WorldConfig entities(long n) {
            return new WorldConfig(
                    Math.max(10, (int) (n / 40) - (int) (n / 200)),   // districts ≈ 2.5%
                    Math.max(10, (int) (n / 40) - (int) (n / 200)),   // plants ≈ 2.5%
                    Math.max(10, (int) (n / 40) - (int) (n / 200)),   // gridNodes ≈ 2.5%
                    Math.max(10, (int) (n * 9 / 10)),                 // vehicles ≈ 90%
                    Math.max(10, (int) (n / 40) - (int) (n / 200)));  // banks ≈ 2.5%
        }
    }

    private WorldFactory() {
    }

    public static SimulationState defaultWorld(int districts, int plants, int gridNodes,
                                               int vehicles, int banks) {
        return world(new WorldConfig(districts, plants, gridNodes, vehicles, banks));
    }

    /** A world with an approximate {@code entities} total entity budget. */
    public static SimulationState entitiesWorld(long entities) {
        return world(WorldConfig.entities(entities));
    }

    public static SimulationState world(WorldConfig cfg) {
        var modules = new HashMap<String, com.gaia.simulator.engine.SimModule>();

        List<District> districts = IntStream.range(0, cfg.districts()).mapToObj(i ->
                new District("district-" + i, regions[i % regions.length],
                        200_000L + (i * 7_331L) % 1_200_000L,
                        300.0 + (i * 17) % 400,
                        400.0 + (i * 23) % 350,
                        600_000 + (i * 1_019) % 600_000,
                        300 + (i * 31) % 900)).toList();

        // Regional demand weights: persistent heterogeneity so regions behave
        // differently (a heatwave in eu-west does not light up africa). Kept
        // deterministic so same seed ⇒ same world ⇒ same events.
        List<GridNode> grid = IntStream.range(0, cfg.gridNodes()).mapToObj(i ->
                new GridNode("node-" + i, regions[i % regions.length],
                        (180.0 + (i * 53) % 260) * REGION_DEMAND_WEIGHT[i % regions.length])).toList();

        // Balance the grid so generation comfortably covers baseline demand
        // (≈1.15×): the world is healthy until an event (heatwave, outage)
        // pushes demand past capacity. This is what makes cross-domain
        // correlations observable instead of a permanently-stressed system.
        double baseLoad = grid.stream().mapToDouble(g -> g.baseLoadMw).sum();
        double capacityPerPlant = baseLoad * 1.15 / Math.max(1, cfg.plants()) / 0.75;

        List<Plant> plants = IntStream.range(0, cfg.plants()).mapToObj(i -> {
            Plant.PlantType type = plantTypes[i % plantTypes.length];
            double capacity = (capacityPerPlant + (i * 67) % 80)
                    * REGION_DEMAND_WEIGHT[i % regions.length];
            return new Plant(type.name().toLowerCase() + "-" + i, capacity,
                    0.6 + 0.05 * (i % 7), type, regions[i % regions.length]);
        }).toList();

        List<Vehicle> vehicles = IntStream.range(0, cfg.vehicles()).mapToObj(i ->
                new Vehicle("v-" + i, vehicleTypes[i % vehicleTypes.length],
                        5 + (i % 30), 0.2 + 0.01 * (i % 20), regions[i % regions.length])).toList();

        List<Bank> banks = IntStream.range(0, cfg.banks()).mapToObj(i ->
                new Bank("bank-" + i, 400 + (i * 97) % 900,
                        120 + (i * 43) % 400, 180 + (i * 29) % 260,
                        regions[i % regions.length])).toList();

        modules.put("energy", new EnergyModule(plants, grid));
        modules.put("cities", new CitiesModule(districts));
        modules.put("transport", new TransportModule(vehicles));
        modules.put("finance", new FinanceModule(banks));
        return new SimulationState(modules);
    }

    private static final String[] regions = {"eu-west", "eu-east", "na-east", "na-west",
            "me", "asia-n", "asia-s", "africa"};

    /** Regional demand/capacity weights (index-aligned with {@link #regions}). */
    static final double[] REGION_DEMAND_WEIGHT = {1.25, 0.90, 1.15, 0.85, 1.05, 1.20, 0.95, 0.80};

    private static final Plant.PlantType[] plantTypes = Plant.PlantType.values();
    private static final Vehicle.VehicleType[] vehicleTypes = Vehicle.VehicleType.values();
}