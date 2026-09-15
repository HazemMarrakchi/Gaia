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
 * Cities module. Entities: districts, buildings, hospitals, water tanks.
 * Reacts to energy grid stress (curtailment) and heatwave-driven hospital load.
 */
public final class CitiesModule implements SimModule {

    private final Deque<SimEvent> events = new ArrayDeque<>();
    private final List<District> districts;
    private double heatwave = 0.0;

    public CitiesModule(List<District> districts) {
        this.districts = districts;
    }

    @Override
    public Domain domain() {
        return Domain.CITIES;
    }

    @Override
    public void tick(TickContext ctx) {
        double strain = 0;
        double hospitalLoad = 0;
        double waterShortage = 0;

        for (District d : districts) {
            double districtHeat = heatwave; // propagated via ctx in production wiring
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
            strain += 0.4 * districtHeat + Math.max(0.0, powerDraw - d.gridCapacity) / d.gridCapacity;
        }

        if (strain > districts.size() * 0.6) {
            emit(ctx, "CITY_STRAIN", "global", Math.min(1.0, strain / districts.size()), "");
        }
        if (waterShortage > 0) {
            emit(ctx, "WATER_SHORTAGE", "global", Math.min(1.0, waterShortage / 1_000_000), "");
        }
        if (hospitalLoad > districts.size() * 100) {
            emit(ctx, "HOSPITAL_LOAD", "global", Math.min(1.0, hospitalLoad / (districts.size() * 200)), "");
        }
    }

    private void emit(TickContext ctx, String type, String region, double severity, String payload) {
        events.add(SimEvent.of(ctx.tick(), ctx.timestamp(), Domain.CITIES, type, region, severity, payload));
    }

    @Override
    public Map<String, Object> state() {
        return Map.of("districts", districts.stream().map(District::snapshot).toList());
    }

    @Override
    public void applyPerturbation(String type, Map<String, Object> params) {
        switch (type) {
            case "HEATWAVE", "HEATWAVE_EU_JULY" -> heatwave = 0.8;
            case "WATER_SHORTAGE" -> districts.forEach(d -> d.waterLevel *= 0.4);
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
        final long population;
        final double basePowerDraw;
        final double gridCapacity;
        final double inflowPerTick;
        final int beds;
        double waterLevel;
        double hospitalOccupancy;

        public District(String id, long population, double basePowerDraw, double gridCapacity,
                        double inflowPerTick, int beds) {
            this.id = id;
            this.population = population;
            this.basePowerDraw = basePowerDraw;
            this.gridCapacity = gridCapacity;
            this.inflowPerTick = inflowPerTick;
            this.beds = beds;
            this.waterLevel = 1_000_000;
        }

        Map<String, Object> snapshot() {
            return Map.of("id", id, "population", population, "waterLevel", waterLevel,
                    "hospitalOccupancy", hospitalOccupancy);
        }
    }
}