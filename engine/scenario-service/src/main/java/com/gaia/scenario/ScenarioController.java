package com.gaia.scenario;

import com.gaia.simulator.domain.WorldFactory;
import com.gaia.simulator.engine.SimulationEngine;
import com.gaia.simulator.engine.SimulationState;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * What-if engine: clones a world, applies perturbations, runs N ticks and
 * returns the diff against the baseline. Results cached in Redis.
 */
@RestController
@RequestMapping("/scenarios")
public class ScenarioController {

    private final StringRedisTemplate redis;

    public ScenarioController(StringRedisTemplate redis) {
        this.redis = redis;
    }

    @PostMapping
    public Map<String, Object> run(@RequestBody ScenarioRequest req) {
        String id = UUID.randomUUID().toString();

        SimulationState baseline = WorldFactory.defaultWorld(3, 4, 3, 4, 3);
        SimulationEngine base = new SimulationEngine(
                cloneState(baseline), 7L, 50L, Instant.parse("2026-09-15T00:00:00Z"));
        base.run(req.baselineTicks());

        SimulationEngine scenario = new SimulationEngine(
                cloneState(baseline), 7L, 50L, Instant.parse("2026-09-15T00:00:00Z"));
        scenario.run(req.baselineTicks());
        req.perturbations().forEach(p -> scenario.state().snapshot().keySet().forEach(domain ->
                simulatePerturbation(scenario, domain, p)));
        long scenarioEvents = scenario.run(req.ticks()).size();

        Map<String, Object> result = new HashMap<>();
        result.put("id", id);
        result.put("baselineTick", base.tickIndex());
        result.put("scenarioEvents", scenarioEvents);
        result.put("diffs", diffStats(base.state().snapshot(), scenario.state().snapshot()));

        redis.opsForValue().set("gaia:scenario:" + id, result.toString());
        return result;
    }

    private static SimulationState cloneState(SimulationState src) {
        // Scaffold: rebuild an identically-seeded world (deep snapshot cloning
        // is the production route via PostGIS state JSON).
        return WorldFactory.defaultWorld(3, 4, 3, 4, 3);
    }

    private void simulatePerturbation(SimulationEngine scenario, String domain, String perturbation) {
        scenario.state().module(domain).applyPerturbation(perturbation, Map.of());
    }

    private Map<String, Object> diffStats(Map<String, Map<String, Object>> base,
                                          Map<String, Map<String, Object>> scenario) {
        return Map.of(
                "energy", Map.of("deltaPlants", 0, "heatwaveApplied",
                        !base.getOrDefault("energy", Map.of()).getOrDefault("heatwaveIntensity", 0.0)
                                .equals(scenario.getOrDefault("energy", Map.of())
                                        .getOrDefault("heatwaveIntensity", 0.0))));
    }

    public record ScenarioRequest(int baselineTicks, int ticks, List<String> perturbations) {
    }
}