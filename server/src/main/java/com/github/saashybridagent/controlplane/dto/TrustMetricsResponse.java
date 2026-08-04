package com.github.saashybridagent.controlplane.dto;

import java.util.List;
import java.util.Map;

public record TrustMetricsResponse(List<Bucket> buckets) {

  public record Bucket(
      String key, long trust, long distrust, long correct, Map<String, Long> byKind) {}
}
