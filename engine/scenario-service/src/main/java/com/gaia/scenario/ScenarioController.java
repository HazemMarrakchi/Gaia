package com.gaia.scenario;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.gaia.simulator.domain.WorldFactory;
import com.gaia.simulator.engine.SimulationEngine;
import com.gaia.simulator.engine.SimulationState;
import io.micrometer.core.instrument.MeterRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * What-if engine: clones the world state, applies perturbations, runs N ticks
 * and returns the diff against an unperturbed baseline. Results cached in Redis.
 */
@RestController
@RequestMapping("/scenarios")
public class ScenarioController {

    private static final long STEP_MS = 50L;
    private static final Instant START = Instant.parse("2026-09-15T00:00:00Z");
    private static final Logger log = LoggerFactory.getLogger(ScenarioController.class);

    private static final String INSERT_SCENARIO =
            "INSERT INTO gaia_scenarios "
                    + "(id, seed, entities, baseline_ticks, scenario_ticks, scenario_events, "
                    + "perturbations, diffs) "
                    + "VALUES (?::uuid, ?, ?, ?, ?, ?, ?::text[], ?::jsonb)";

    private final StringRedisTemplate redis;
    private final JdbcTemplate jdbc;
    private final MeterRegistry meters;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public ScenarioController(StringRedisTemplate redis, JdbcTemplate jdbc, MeterRegistry meters) {
        this.redis = redis;
        this.jdbc = jdbc;
        this.meters = meters;
    }

    @PostMapping
    public Map<String, Object> run(@RequestBody ScenarioRequest req) {
        String id = UUID.randomUUID().toString();
        long seed = req.seed() == 0 ? 7L : req.seed();

        SimulationState world = WorldFactory.entitiesWorld(req.entities() == 0 ? 10_000 : req.entities());
        SimulationState baseState = world.deepCopy();
        SimulationState scenarioState = world.deepCopy();

        SimulationEngine base = new SimulationEngine(baseState, seed, STEP_MS, START);
        base.run(req.baselineTicks());

        SimulationEngine scenario = new SimulationEngine(scenarioState, seed, STEP_MS, START);
        scenario.run(req.baselineTicks());
        req.perturbations().forEach(p -> scenarioState.snapshot().keySet().forEach(domain ->
                applyPerturbation(scenario, domain, p)));

        // Run both engines for the scenario window so the diff compares
        // "baseline at T+N" vs "scenario at T+N" — not a frozen snapshot.
        base.run(req.ticks());
        long scenarioEvents = scenario.run(req.ticks()).size();

        Map<String, Map<String, Object>> diffs = diffStats(baseState.snapshot(), scenarioState.snapshot());

        Map<String, Object> result = new java.util.HashMap<>();
        result.put("id", id);
        result.put("baselineTick", base.tickIndex());
        result.put("scenarioTicks", scenario.tickIndex());
        result.put("scenarioEvents", scenarioEvents);
        result.put("diffs", diffs);
        result.put("perturbations", req.perturbations());

        cache(id, result);
        meters.counter("gaia_sim_scenarios").increment();
        persist(id, seed, req, scenarioEvents, diffs);
        return result;
    }

    /**
     * Best-effort Redis cache ({@code gaia:scenario:{id}}): a down cache must never
     * fail a what-if run — the diff was already computed, so return it anyway.
     */
    private void cache(String id, Map<String, Object> result) {
        try {
            redis.opsForValue().set("gaia:scenario:" + id, result.toString());
        } catch (Exception ex) {
            log.warn("scenario {} not cached (Redis unavailable: {})", id, ex.getMessage());
        }
    }

    /**
     * Mirrors the run into PostGIS ({@code gaia_scenarios}) so diffs stay queryable.
     * Best effort: Redis remains the source of truth for the live demo.
     */
    private void persist(String id, long seed, ScenarioRequest req, long scenarioEvents,
                         Map<String, Map<String, Object>> diffs) {
        try {
            jdbc.update(INSERT_SCENARIO, id, seed, req.entities(), req.baselineTicks(),
                    req.ticks(), scenarioEvents, toPgTextArray(req.perturbations()),
                    objectMapper.writeValueAsString(diffs));
        } catch (Exception ex) {
            log.warn("scenario {} kept in Redis only (PostGIS unavailable: {})", id, ex.getMessage());
        }
    }

    /** {@code ["a","b"]} → {@code {"a","b"}} (PostgreSQL text[] literal). */
    private static String toPgTextArray(List<String> values) {
        return values.stream()
                .map(v -> "\"" + v.replace("\"", "\\\"") + "\"")
                .collect(Collectors.joining(",", "{", "}"));
    }

    private void applyPerturbation(SimulationEngine scenario, String domain, String perturbation) {
        scenario.state().module(domain).applyPerturbation(perturbation, Map.of());
    }

    /** Compares final snapshots of baseline vs scenario on stable metrics. */
    private Map<String, Map<String, Object>> diffStats(Map<String, Map<String, Object>> base,
                                                       Map<String, Map<String, Object>> scenario) {
        return Map.of(
                "energy", Map.of(
                        "heatwaveDelta", scalar(base, scenario, "energy", "heatwaveIntensity"),
                        "outageDelta", outages(scenario, "energy") - outages(base, "energy")),
                "cities", Map.of(
                        "waterLevelDelta", avgDelta(base, scenario, "cities", "districts", "waterLevel"),
                        "strainDelta", scalar(base, scenario, "cities", "heatwave")),
                "transport", Map.of(
                        "delayDelta", avgDelta(base, scenario, "transport", "vehicles", "remainingTicks"),
                        "fuelDelta", scalar(base, scenario, "transport", "fuelPriceIndex")),
                "finance", Map.of(
                        "indexDelta", scalar(base, scenario, "finance", "indexLevel"),
                        "volatilityDelta", scalar(base, scenario, "finance", "volatility"),
                        "capitalDelta", avgDelta(base, scenario, "finance", "banks", "capital")));
    }

    private static double scalar(Map<String, Map<String, Object>> a,
                                 Map<String, Map<String, Object>> b, String domain, String key) {
        return scalarOf(b, domain, key) - scalarOf(a, domain, key);
    }

    private static double scalarOf(Map<String, Map<String, Object>> snap, String domain, String key) {
        Object v = snap.getOrDefault(domain, Map.of()).get(key);
        return v instanceof Number n ? n.doubleValue() : 0.0;
    }

    private static int outages(Map<String, Map<String, Object>> snap, String domain) {
        Object plants = snap.getOrDefault(domain, Map.of()).get("plants");
        if (!(plants instanceof List<?> list)) return 0;
        return (int) list.stream().filter(p -> {
            Map<?, ?> m = (Map<?, ?>) p;
            return "OUTAGE".equals(m.get("status"));
        }).count();
    }

    private static double avgDelta(Map<String, Map<String, Object>> a,
                                   Map<String, Map<String, Object>> b,
                                   String domain, String listKey, String field) {
        return avg(b, domain, listKey, field) - avg(a, domain, listKey, field);
    }

    private static double avg(Map<String, Map<String, Object>> snap, String domain,
                              String listKey, String field) {
        Object list = snap.getOrDefault(domain, Map.of()).get(listKey);
        if (!(list instanceof List<?> rows) || rows.isEmpty()) return 0;
        return rows.stream().mapToDouble(r -> num((Map<String, Object>) r, field)).average().orElse(0);
    }

    private static double num(Map<String, Object> row, String key) {
        Object v = row.get(key);
        return v instanceof Number n ? n.doubleValue() : 0.0;
    }

    public record ScenarioRequest(int baselineTicks, int ticks, List<String> perturbations,
                                  long seed, long entities) {
    }
}