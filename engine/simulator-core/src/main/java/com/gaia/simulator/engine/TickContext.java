package com.gaia.simulator.engine;

import java.time.Instant;
import java.util.SplittableRandom;

/**
 * Immutable per-tick context: timestamp, tick index, and the deterministic
 * RNG derived from the run seed. Same seed + same config ⇒ identical ticks.
 */
public record TickContext(long tick, Instant timestamp, SplittableRandom rng) {

    public static TickContext next(TickContext ctx, long stepMillis, long seed) {
        long nextTick = ctx.tick() + 1;
        return new TickContext(nextTick, ctx.timestamp().plusMillis(stepMillis),
                new SplittableRandom(seed));
    }
}