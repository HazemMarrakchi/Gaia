package com.gaia.simulator.domain.event;

import com.gaia.simulator.domain.Domain;

import java.time.Instant;
import java.util.UUID;

/**
 * An emission from a simulation module. This is the only cross-domain
 * communication channel (published to Kafka by the ingestion service).
 */
public record SimEvent(
        String id,
        long tick,
        Instant ts,
        Domain domain,
        String type,
        String region,
        double severity,
        String payloadJson
) {
    public static SimEvent of(long tick, Instant ts, Domain domain, String type,
                              String region, double severity, String payloadJson) {
        return new SimEvent(UUID.randomUUID().toString(), tick, ts,
                domain, type, region, severity, payloadJson);
    }
}