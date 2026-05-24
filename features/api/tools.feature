Feature: Editor toolbar tools

  Scenario: Tools endpoint lists bundled toolbar modules
    When I request GET "/api/tools"
    Then the response status should be 200
    And the response JSON "tools" should include "10-undo"
    And the response JSON "tools" should include "20-bold"
    And the response JSON "tools" should not include "image-accelerator"
    And the response JSON "tools" should not include "image-markdown"
