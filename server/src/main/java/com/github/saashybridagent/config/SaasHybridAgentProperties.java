package com.github.saashybridagent.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "saas-hybrid-agent")
public class SaasHybridAgentProperties {

  private final ControlPlane controlPlane = new ControlPlane();

  public ControlPlane getControlPlane() {
    return controlPlane;
  }

  public static class ControlPlane {
    private final Quota quota = new Quota();
    private final RateLimit rateLimit = new RateLimit();

    public Quota getQuota() {
      return quota;
    }

    public RateLimit getRateLimit() {
      return rateLimit;
    }
  }

  public static class Quota {
    private int llmTokensLimit = 1_000_000;
    private int embeddingCallsLimit = 10_000;

    public int getLlmTokensLimit() {
      return llmTokensLimit;
    }

    public void setLlmTokensLimit(int llmTokensLimit) {
      this.llmTokensLimit = llmTokensLimit;
    }

    public int getEmbeddingCallsLimit() {
      return embeddingCallsLimit;
    }

    public void setEmbeddingCallsLimit(int embeddingCallsLimit) {
      this.embeddingCallsLimit = embeddingCallsLimit;
    }
  }

  public static class RateLimit {
    private int chatRequestsPerWindow = 1000;

    public int getChatRequestsPerWindow() {
      return chatRequestsPerWindow;
    }

    public void setChatRequestsPerWindow(int chatRequestsPerWindow) {
      this.chatRequestsPerWindow = chatRequestsPerWindow;
    }
  }
}
