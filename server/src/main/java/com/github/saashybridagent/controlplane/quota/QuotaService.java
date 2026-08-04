package com.github.saashybridagent.controlplane.quota;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

import org.springframework.stereotype.Service;

import com.github.saashybridagent.config.SaasHybridAgentProperties;
import com.github.saashybridagent.controlplane.dto.QuotaResponse;

@Service
public class QuotaService {

  private final SaasHybridAgentProperties properties;
  private final Map<String, AtomicInteger> llmTokensByUser = new ConcurrentHashMap<>();
  private final Map<String, AtomicInteger> embeddingCallsByUser = new ConcurrentHashMap<>();

  public QuotaService(SaasHybridAgentProperties properties) {
    this.properties = properties;
  }

  public void recordLlmTokens(String userId, int tokens) {
    if (tokens <= 0) {
      return;
    }
    llmTokensByUser.computeIfAbsent(userId, ignored -> new AtomicInteger()).addAndGet(tokens);
  }

  public void recordEmbeddingCall(String userId) {
    embeddingCallsByUser.computeIfAbsent(userId, ignored -> new AtomicInteger()).incrementAndGet();
  }

  public QuotaResponse getQuota(String userId) {
    int llmUsed = llmTokensByUser.computeIfAbsent(userId, ignored -> new AtomicInteger()).get();
    int embedUsed =
        embeddingCallsByUser.computeIfAbsent(userId, ignored -> new AtomicInteger()).get();
    var quota = properties.getControlPlane().getQuota();
    return new QuotaResponse(
        llmUsed, quota.getLlmTokensLimit(), embedUsed, quota.getEmbeddingCallsLimit());
  }

  public boolean isLlmOverLimit(String userId) {
    return getQuota(userId).llmTokensUsed() >= getQuota(userId).llmTokensLimit();
  }
}
