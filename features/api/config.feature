Feature: Server configuration

  Scenario: Config endpoint exposes the working directory
    When I request GET "/api/config"
    Then the response status should be 200
    And the response JSON should include "defaultProjectPath"
