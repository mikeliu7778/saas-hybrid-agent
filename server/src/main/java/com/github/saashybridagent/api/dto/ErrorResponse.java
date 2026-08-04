package com.github.saashybridagent.api.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record ErrorResponse(String code, String message, Object details) {

  public static ErrorResponse of(String code, String message) {
    return new ErrorResponse(code, message, null);
  }
}
