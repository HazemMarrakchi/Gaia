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

    /** Deep copy used by the what-if machinery (perturb a clone, not the live world). */
    public SimulationState deepCopy() {
        var copy = new java.util.LinkedHashMap<String, SimModule>();
        modules.forEach((k, m) -> copy.put(k, m.copy()));
        return new SimulationState(copy);
    }
}