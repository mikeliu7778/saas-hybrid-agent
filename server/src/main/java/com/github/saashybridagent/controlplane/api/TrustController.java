package com.github.saashybridagent.controlplane.api;

import java.time.Instant;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.github.saashybridagent.controlplane.auth.DeviceAuthAttributes;
import com.github.saashybridagent.controlplane.dto.TrustEventsRequest;
import com.github.saashybridagent.controlplane.dto.TrustEventsResponse;
import com.github.saashybridagent.controlplane.dto.TrustMetricsResponse;
import com.github.saashybridagent.controlplane.trust.InMemoryTrustEventStore;

import jakarta.validation.Valid;

@RestController
@RequestMapping("/v1/trust")
public class TrustController {

  private final InMemoryTrustEventStore trustEventStore;

  public TrustController(InMemoryTrustEventStore trustEventStore) {
    this.trustEventStore = trustEventStore;
  }

  @PostMapping("/events")
  public TrustEventsResponse appendEvents(
      @Valid @RequestBody TrustEventsRequest request,
      @RequestAttribute(DeviceAuthAttributes.USER_ID) String userId) {
    return trustEventStore.append(userId, request.events());
  }

  @GetMapping("/metrics")
  public TrustMetricsResponse metrics(
      @RequestParam(name = "from", required = false) Instant from,
      @RequestParam(name = "to", required = false) Instant to,
      @RequestParam(name = "grain", defaultValue = "day") String grain,
      @RequestAttribute(DeviceAuthAttributes.USER_ID) String userId) {
    return trustEventStore.metrics(userId, from, to, grain);
  }
}
