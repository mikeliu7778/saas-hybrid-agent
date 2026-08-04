package com.github.saashybridagent.controlplane.llm;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

import org.springframework.stereotype.Component;

import com.github.saashybridagent.config.SaasHybridAgentProperties;

@Component
public class RateLimiter {

  private final SaasHybridAgentProperties properties;
  private final Map<String, AtomicInteger> chatRequests = new ConcurrentHashMap<>();

  public RateLimiter(SaasHybridAgentProperties properties) {
    this.properties = properties;
  }

  public boolean tryAcquireChat(String userId) {
    int limit = properties.getControlPlane().getRateLimit().getChatRequestsPerWindow();
    if (limit <= 0) {
      return true;
    }
    return chatRequests.computeIfAbsent(userId, ignored -> new AtomicInteger()).incrementAndGet()
        <= limit;
  }

  void reset() {
    chatRequests.clear();
  }
}
