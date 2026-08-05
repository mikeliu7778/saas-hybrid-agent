package com.github.saashybridagent.config;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

@EnableConfigurationProperties(SaasHybridAgentProperties.class)
class SaasHybridAgentPropertiesTest {

  private final ApplicationContextRunner contextRunner =
      new ApplicationContextRunner()
          .withUserConfiguration(SaasHybridAgentPropertiesTest.class)
          .withPropertyValues(
              "saas-hybrid-agent.llm.default-provider=cursor",
              "saas-hybrid-agent.llm.cursor-sidecar-url=http://127.0.0.1:8091");

  @Test
  void bindsNestedLlmProperties() {
    contextRunner.run(
        context -> {
          SaasHybridAgentProperties properties = context.getBean(SaasHybridAgentProperties.class);
          assertThat(properties.getLlm().getDefaultProvider()).isEqualTo("cursor");
          assertThat(properties.getLlm().getCursorSidecarUrl())
              .isEqualTo("http://127.0.0.1:8091");
        });
  }
}
