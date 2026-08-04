package com.github.saashybridagent.config;

import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.Ordered;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.github.saashybridagent.auth.BearerTokenFilter;
import com.github.saashybridagent.controlplane.auth.DeviceRegistry;

@Configuration
public class SecurityConfig {

  @Bean
  FilterRegistrationBean<BearerTokenFilter> bearerTokenFilter(
      ObjectMapper objectMapper, DeviceRegistry deviceRegistry) {
    FilterRegistrationBean<BearerTokenFilter> registration = new FilterRegistrationBean<>();
    registration.setFilter(new BearerTokenFilter(objectMapper, deviceRegistry));
    registration.addUrlPatterns("/*");
    registration.setOrder(Ordered.HIGHEST_PRECEDENCE);
    return registration;
  }
}
