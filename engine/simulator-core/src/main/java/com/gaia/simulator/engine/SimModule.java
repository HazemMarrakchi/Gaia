package com.gaia.simulator.engine;

import com.gaia.simulator.domain.Domain;
import com.gaia.simulator.domain.event.SimEvent;

import java.util.List;
import java.util.Map;

/**
 * Contract for a domain module inside the simulation.
 * Each module manages its own entities, applies tick logic, and drains
 * domain-specific events that the ingestion service publishes to Kafka.
 *
 * Execution order is fixed by the engine: ENERGY → CITIES → TRANSPORT → FINANCE.
 */
public interface SimModule {

    /** Domain identifier (energy, cities, transport, finance). */
    Domain domain();

    /** Called once per tick; mutates internal state. */
    void tick(TickContext ctx);

    /** Returns a JSON-serializable snapshot of current domain state (for cloning / what-if). */
    Map<String, Object> state();

    /** Applies a named perturbation to this module's state (for scenario cloning). */
    void applyPerturbation(String perturbationType, Map<String, Object> params);

    /** Drains events emitted during the last tick and clears the buffer. */
    List<SimEvent> drainEvents();

    /**
     * Deep copy of this module for what-if cloning. Must reproduce every
     * mutable field so the clone can be perturbed without altering the seed state.
     */
    default SimModule copy() {
        throw new UnsupportedOperationException("copy not implemented for " + domain());
    }
}