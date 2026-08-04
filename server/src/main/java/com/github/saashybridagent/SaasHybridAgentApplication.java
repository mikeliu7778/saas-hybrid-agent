package com.github.saashybridagent;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;

import com.github.saashybridagent.config.SaasHybridAgentProperties;

@SpringBootApplication
@EnableConfigurationProperties(SaasHybridAgentProperties.class)
public class SaasHybridAgentApplication {

  public static void main(String[] args) {
    SpringApplication.run(SaasHybridAgentApplication.class, args);
  }
}
