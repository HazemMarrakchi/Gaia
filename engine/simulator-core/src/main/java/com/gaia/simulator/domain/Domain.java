package com.gaia.simulator.domain;

/**
 * Domain categories of the GAIA simulation.
 */
public enum Domain {
    ENERGY("energy"),
    CITIES("cities"),
    TRANSPORT("transport"),
    FINANCE("finance");

    private final String label;

    Domain(String label) {
        this.label = label;
    }

    public String label() {
        return label;
    }
}