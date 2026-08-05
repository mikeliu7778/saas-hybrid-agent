package com.github.saashybridagent.controlplane.llm;

public class MultimodalValidationException extends RuntimeException {
  private final String code;

  public MultimodalValidationException(String code, String message) {
    super(message);
    this.code = code;
  }

  public String getCode() {
    return code;
  }
}
