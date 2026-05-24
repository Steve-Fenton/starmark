Feature: User settings

  Scenario: Settings endpoint returns defaults
    When I request GET "/api/settings"
    Then the response status should be 200
    And the response JSON should include "settings"

  Scenario: Settings can be updated
    When I request PUT "/api/settings" with JSON:
      """
      {"settings":{"images":"markdown"}}
      """
    Then the response status should be 200
    And the response JSON settings "images" should be "markdown"
