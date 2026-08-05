package com.github.saashybridagent.api;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import com.github.saashybridagent.api.dto.ErrorResponse;
import com.github.saashybridagent.controlplane.llm.CursorSidecarException;
import com.github.saashybridagent.controlplane.llm.LlmGatewayService.RateLimitExceededException;

@RestControllerAdvice
public class ApiExceptionHandler {

  @ExceptionHandler(RateLimitExceededException.class)
  public ResponseEntity<ErrorResponse> rateLimited(RateLimitExceededException ex) {
    return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
        .body(ErrorResponse.of("rate_limited", ex.getMessage()));
  }

  @ExceptionHandler(CursorSidecarException.class)
  public ResponseEntity<ErrorResponse> cursor(CursorSidecarException ex) {
    return ResponseEntity.status(ex.getStatus())
        .body(ErrorResponse.of(ex.getCode(), ex.getMessage()));
  }

  @ExceptionHandler(IllegalArgumentException.class)
  public ResponseEntity<ErrorResponse> illegalArgument(IllegalArgumentException ex) {
    String message = ex.getMessage() == null ? "bad request" : ex.getMessage();
    return ResponseEntity.badRequest().body(ErrorResponse.of("bad_request", message));
  }

  @ExceptionHandler(SecurityException.class)
  public ResponseEntity<ErrorResponse> security(SecurityException ex) {
    return ResponseEntity.badRequest()
        .body(ErrorResponse.of("validation_error", ex.getMessage()));
  }

  @ExceptionHandler(MethodArgumentNotValidException.class)
  public ResponseEntity<ErrorResponse> validation(MethodArgumentNotValidException ex) {
    String message =
        ex.getBindingResult().getFieldErrors().stream()
            .findFirst()
            .map(err -> err.getField() + ": " + err.getDefaultMessage())
            .orElse("validation failed");
    return ResponseEntity.badRequest().body(ErrorResponse.of("validation_error", message));
  }

  @ExceptionHandler(IllegalStateException.class)
  public ResponseEntity<ErrorResponse> illegalState(IllegalStateException ex) {
    return ResponseEntity.badRequest()
        .body(ErrorResponse.of("validation_error", ex.getMessage()));
  }
}
