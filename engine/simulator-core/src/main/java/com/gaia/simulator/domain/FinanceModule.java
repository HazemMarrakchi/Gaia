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
 * Finance module. Entities: market, banks, risk desks, cash flows.
 * Receives cross-domain shocks (energy, transport) and surfaces liquidity
 * stress and VaR breaches to the alerting layer.
 */
public final class FinanceModule implements SimModule {

    private final Deque<SimEvent> events = new ArrayDeque<>();
    private final List<Bank> banks;
    private double volatility = 0.2;
    private double indexLevel = 100.0;

    public FinanceModule(List<Bank> banks) {
        this.banks = banks;
    }

    @Override
    public Domain domain() {
        return Domain.FINANCE;
    }

    @Override
    public void tick(TickContext ctx) {
        double shock = externalShock();
        volatility = clamp(volatility * (1.0 + shock * 0.3) + 0.01 * ctx.rng().nextGaussian());
        indexLevel *= 1.0 - shock * 0.02 + 0.001 * ctx.rng().nextGaussian();

        double liquidityStress = 0;
        double maxVar = 0;
        for (Bank b : banks) {
            b.capital -= b.exposure * shock * 0.1;
            double var = b.exposure * volatility;
            maxVar = Math.max(maxVar, var);
            if (b.capital < b.minCapital) {
                liquidityStress += (b.minCapital - b.capital) / b.minCapital;
            }
        }

        if (liquidityStress > 0.3) {
            emit(ctx, "LIQUIDITY_STRESS", "global", Math.min(1.0, liquidityStress), "{}");
        }
        if (maxVar > 6.0) {
            emit(ctx, "VAR_BREACH", "global", Math.min(1.0, maxVar / 10.0), "{}");
        }
        if (Math.abs(shock) > 0.1) {
            emit(ctx, "PRICE_SHOCK", "global", Math.min(1.0, shock), "{}");
        }
    }

    private double externalShock() {
        // In the production wiring this reads cross-domain severity from ticks;
        // scaffold reads a 5-period EMA of recent shocks pushed by the engine.
        return lastExternalShock;
    }

    private double lastExternalShock = 0.02;

    private static double clamp(double v) {
        return Math.max(0.05, Math.min(2.0, v));
    }

    private void emit(TickContext ctx, String type, String region, double severity, String payload) {
        events.add(SimEvent.of(ctx.tick(), ctx.timestamp(), Domain.FINANCE, type, region, severity, payload));
    }

    @Override
    public Map<String, Object> state() {
        return Map.of("volatility", volatility, "indexLevel", indexLevel,
                "banks", banks.stream().map(Bank::snapshot).toList());
    }

    @Override
    public void applyPerturbation(String type, Map<String, Object> params) {
        switch (type) {
            case "PRICE_SHOCK", "SHOCK" -> lastExternalShock = 0.25;
            case "INJECT_LIQUIDITY" -> banks.forEach(b -> b.capital *= 1.2);
            default -> { /* no-op */ }
        }
    }

    @Override
    public List<SimEvent> drainEvents() {
        List<SimEvent> out = new ArrayList<>(events);
        events.clear();
        return out;
    }

    public static final class Bank {
        final String name;
        double capital;
        final double exposure;
        final double minCapital;

        public Bank(String name, double capital, double exposure, double minCapital) {
            this.name = name;
            this.capital = capital;
            this.exposure = exposure;
            this.minCapital = minCapital;
        }

        Map<String, Object> snapshot() {
            return Map.of("name", name, "capital", capital, "exposure", exposure);
        }
    }
}