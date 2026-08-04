package com.github.saashybridagent.controlplane.trust;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.stereotype.Service;

import com.github.saashybridagent.controlplane.dto.TrustEventDto;
import com.github.saashybridagent.controlplane.dto.TrustEventsResponse;
import com.github.saashybridagent.controlplane.dto.TrustMetricsResponse;

@Service
public class InMemoryTrustEventStore {

  private static final Set<String> VALID_SIGNALS = Set.of("trust", "distrust", "correct");
  private static final double DEFAULT_STRENGTH = 0.5;

  private final Map<String, Map<String, StoredEvent>> byUser = new ConcurrentHashMap<>();

  /**
   * Appends events for a user. Idempotent on eventId.
   *
   * <p>If any event in the batch is missing required fields or has an invalid signal, the whole
   * batch is rejected with IllegalArgumentException (HTTP 400) and nothing is stored.
   */
  public TrustEventsResponse append(String userId, List<TrustEventDto> events) {
    if (events == null || events.isEmpty()) {
      throw new IllegalArgumentException("events must not be empty");
    }
    for (TrustEventDto event : events) {
      validate(event);
    }

    Map<String, StoredEvent> store =
        byUser.computeIfAbsent(userId, ignored -> new ConcurrentHashMap<>());
    int accepted = 0;
    int duplicates = 0;
    for (TrustEventDto event : events) {
      double strength = clampStrength(event.strength());
      StoredEvent stored =
          new StoredEvent(
              event.eventId(),
              event.kind(),
              event.target(),
              event.targetId(),
              event.signal(),
              strength,
              event.ts());
      StoredEvent previous = store.putIfAbsent(event.eventId(), stored);
      if (previous == null) {
        accepted++;
      } else {
        duplicates++;
      }
    }
    return new TrustEventsResponse(accepted, duplicates);
  }

  public TrustMetricsResponse metrics(String userId, Instant from, Instant to, String grain) {
    if (grain != null && !grain.isBlank() && !"day".equals(grain)) {
      throw new IllegalArgumentException("unsupported grain: " + grain + " (only day)");
    }

    Map<String, StoredEvent> store = byUser.getOrDefault(userId, Map.of());
    Map<String, MutableBucket> buckets = new LinkedHashMap<>();

    for (StoredEvent event : store.values()) {
      Instant ts = event.ts();
      if (from != null && ts.isBefore(from)) {
        continue;
      }
      if (to != null && !ts.isBefore(to)) {
        continue;
      }
      String key = LocalDate.ofInstant(ts, ZoneOffset.UTC).toString();
      MutableBucket bucket = buckets.computeIfAbsent(key, ignored -> new MutableBucket());
      switch (event.signal()) {
        case "trust" -> bucket.trust++;
        case "distrust" -> bucket.distrust++;
        case "correct" -> bucket.correct++;
        default -> {
          /* validated on ingest */
        }
      }
      bucket.byKind.merge(event.kind(), 1L, Long::sum);
    }

    List<TrustMetricsResponse.Bucket> result = new ArrayList<>();
    buckets.entrySet().stream()
        .sorted(Map.Entry.comparingByKey(Comparator.naturalOrder()))
        .forEach(
            entry -> {
              MutableBucket b = entry.getValue();
              result.add(
                  new TrustMetricsResponse.Bucket(
                      entry.getKey(), b.trust, b.distrust, b.correct, Map.copyOf(b.byKind)));
            });
    return new TrustMetricsResponse(result);
  }

  private static void validate(TrustEventDto event) {
    if (event == null) {
      throw new IllegalArgumentException("event must not be null");
    }
    requireNonBlank(event.eventId(), "eventId");
    requireNonBlank(event.kind(), "kind");
    requireNonBlank(event.target(), "target");
    requireNonBlank(event.targetId(), "targetId");
    requireNonBlank(event.signal(), "signal");
    if (event.ts() == null) {
      throw new IllegalArgumentException("ts is required");
    }
    if (!VALID_SIGNALS.contains(event.signal())) {
      throw new IllegalArgumentException(
          "signal must be one of trust|distrust|correct, got: " + event.signal());
    }
  }

  private static void requireNonBlank(String value, String field) {
    if (value == null || value.isBlank()) {
      throw new IllegalArgumentException(field + " is required");
    }
  }

  private static double clampStrength(Double strength) {
    double value = strength == null ? DEFAULT_STRENGTH : strength;
    if (value < 0.0) {
      return 0.0;
    }
    if (value > 1.0) {
      return 1.0;
    }
    return value;
  }

  private static final class MutableBucket {
    long trust;
    long distrust;
    long correct;
    final Map<String, Long> byKind = new LinkedHashMap<>();
  }

  record StoredEvent(
      String eventId,
      String kind,
      String target,
      String targetId,
      String signal,
      double strength,
      Instant ts) {}
}
