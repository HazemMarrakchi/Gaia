package com.gaia.simulator.domain;

import com.gaia.simulator.domain.CitiesModule.District;
import com.gaia.simulator.domain.EnergyModule.GridNode;
import com.gaia.simulator.domain.EnergyModule.Plant;
import com.gaia.simulator.domain.FinanceModule.Bank;
import com.gaia.simulator.domain.TransportModule.Vehicle;
import com.gaia.simulator.engine.SimulationState;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Builds a ready-to-run {@link SimulationState} with a realistic world:
 * regional grid tied to districts, transport operators, banks.
 */
public final class WorldFactory {

    private WorldFactory() {
    }

    public static SimulationState defaultWorld(int districts, int plants, int gridNodes,
                                               int vehicles, int banks) {
        var modules = new HashMap<String, com.gaia.simulator.engine.SimModule>();

        List<District> districtList = List.of(
                new District("district-a", 1_200_000, 520.0, 600.0, 80_000, 1_200),
                new District("district-b", 840_000, 410.0, 480.0, 60_000, 900),
                new District("district-c", 310_000, 150.0, 180.0, 25_000, 400));

        List<GridNode> gridList = List.of(
                new GridNode("node-42", "eu-west", 300.0),
                new GridNode("node-43", "eu-west", 240.0),
                new GridNode("node-77", "eu-east", 260.0));

        List<Plant> plantList = List.of(
                new Plant("solar-1", 180, 0.85, Plant.PlantType.SOLAR),
                new Plant("wind-1", 140, 0.6, Plant.PlantType.WIND),
                new Plant("thermal-A", 320, 0.9, Plant.PlantType.THERMAL),
                new Plant("backup-1", 60, 1.0, Plant.PlantType.BACKUP));

        List<Vehicle> vehicleList = List.of(
                new Vehicle("truck-1", Vehicle.VehicleType.TRUCK, 12, 0.9),
                new Vehicle("truck-2", Vehicle.VehicleType.TRUCK, 15, 1.1),
                new Vehicle("train-1", Vehicle.VehicleType.TRAIN, 8, 0.3),
                new Vehicle("ship-1", Vehicle.VehicleType.SHIP, 40, 1.8));

        List<Bank> bankList = List.of(
                new Bank("atlas", 850.0, 380.0, 500.0),
                new Bank("meridian", 640.0, 250.0, 400.0),
                new Bank("solbank", 420.0, 300.0, 320.0));

        modules.put("energy", new EnergyModule(plantList, gridList));
        modules.put("cities", new CitiesModule(districtList));
        modules.put("transport", new TransportModule(vehicleList));
        modules.put("finance", new FinanceModule(bankList));
        return new SimulationState(modules);
    }
}