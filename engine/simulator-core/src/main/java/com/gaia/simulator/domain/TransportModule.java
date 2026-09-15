package com.gaia.simulator.domain;

import com.gaia.simulator.engine.SimModule;
import com.gaia.simulator.engine.TickContext;
import com.gaia.simulator.domain.event.SimEvent;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.Map;

/**
 * Transport module. Entities: networks, vehicles, shipments, traffic metrics.
 * Fuel price (from Energy) and weather disruption affect flow, delays and emissions.
 */
public final class TransportModule implements SimModule {

    private final Deque<SimEvent> events = new ArrayDeque<>();
    private final List<Vehicle> vehicles;
    private double fuelPriceIndex = 1.0;
    private double disruption = 0.0;

    public TransportModule(List<Vehicle> vehicles) {
        this.vehicles = vehicles;
    }

    @Override
    public Domain domain() {
        return Domain.TRANSPORT;
    }

    @Override
    public void tick(TickContext ctx) {
        double totalDelays = 0;
        double totalEmissions = 0;
        double flow = 0;

        for (Vehicle v : vehicles) {
            double speedFactor = 1.0 - disruption * 0.5 - Math.max(0.0, (fuelPriceIndex - 1.0)) * 0.1;
            double delay = (1.0 - speedFactor) * v.averageTripTicks;
            v.remainingTicks += delay;
            v.remainingTicks--;
            totalDelays += Math.max(0.0, delay);

            double emissions = v.emissionsPerTick * (1.0 + disruption * 2.0 + fuelPriceIndex * 0.2);
            totalEmissions += emissions;
            flow += v.isDelayed() ? 0.5 : 1.0;
        }

        if (totalDelays > vehicles.size() * 2) {
            emit(ctx, "SHIPMENT_DELAY", "global", Math.min(1.0, totalDelays / (vehicles.size() * 5)), "");
        }
        if (totalEmissions > vehicles.size() * 0.5) {
            emit(ctx, "EMISSIONS_SPIKE", "global", Math.min(1.0, totalEmissions / vehicles.size()), "");
        }
        double[] last = {flow / Math.max(1, vehicles.size())};
        emit(ctx, "FLOW_CHANGED", "global", Math.max(0.0, Math.min(1.0, 1.0 - last[0])), "");
    }

    private void emit(TickContext ctx, String type, String region, double severity, String payload) {
        events.add(SimEvent.of(ctx.tick(), ctx.timestamp(), Domain.TRANSPORT, type, region, severity, payload));
    }

    @Override
    public Map<String, Object> state() {
        return Map.of("fuelPriceIndex", fuelPriceIndex, "disruption", disruption,
                "vehicles", vehicles.stream().map(Vehicle::snapshot).toList());
    }

    @Override
    public void applyPerturbation(String type, Map<String, Object> params) {
        switch (type) {
            case "FUEL_SPIKE", "ENERGY_PRICE_INCREASE" -> fuelPriceIndex += 0.4;
            case "HEATWAVE", "WEATHER_DISRUPTION" -> disruption = 0.6;
            case "DIVERT_SHIPMENT_ROUTE" -> vehicles.forEach(v -> v.remainingTicks *= 0.7);
            default -> { /* no-op */ }
        }
    }

    @Override
    public List<SimEvent> drainEvents() {
        List<SimEvent> out = new ArrayList<>(events);
        events.clear();
        return out;
    }

    public static final class Vehicle {
        final String id;
        final VehicleType type;
        final double averageTripTicks;
        final double emissionsPerTick;
        double remainingTicks = 1;

        public enum VehicleType { TRUCK, TRAIN, SHIP }

        public Vehicle(String id, VehicleType type, double averageTripTicks, double emissionsPerTick) {
            this.id = id;
            this.type = type;
            this.averageTripTicks = averageTripTicks;
            this.emissionsPerTick = emissionsPerTick;
        }

        boolean isDelayed() {
            return remainingTicks > averageTripTicks * 1.5;
        }

        Map<String, Object> snapshot() {
            return Map.of("id", id, "type", type.name(), "remainingTicks", remainingTicks);
        }
    }
}