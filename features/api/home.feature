Feature: Home page

  Scenario: The app serves the editor UI
    When I request GET "/"
    Then the response status should be 200
    And the response body should contain "starmark"
