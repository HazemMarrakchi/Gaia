package com.gaia.simulator.engine;

import com.gaia.simulator.domain.event.SimEvent;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Holds the set of active modules and the events drained across all of them
 * during the last tick. Modules are ticked in dependency order.
 */
public final class SimulationState {

    private final Map<String, SimModule> modules;
    private final List<SimEvent> pendingEvents = new ArrayList<>();

    public SimulationState(Map<String, SimModule> modules) {
        this.modules = modules;
    }

    public SimModule module(String name) {
        return modules.get(name);
    }

    public List<SimEvent> drainAllEvents() {
        List<SimEvent> events = new ArrayList<>(pendingEvents);
        pendingEvents.clear();
        return events;
    }

    public void collect(List<SimEvent> events) {
        pendingEvents.addAll(events);
    }

    public Map<String, Map<String, Object>> snapshot() {
        Map<String, Map<String, Object>> snap = new java.util.LinkedHashMap<>();
        modules.forEach((k, m) -> snap.put(k, m.state()));
        return snap;
    }
}