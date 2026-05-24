@settings
Feature: Editor toolbar

  Scenario: Static toolbar tools exclude managed image tools
    When I request GET "/api/tools"
    Then the response status should be 200
    And the static toolbar tools should exclude managed image tools

  Scenario Outline: Project image setting selects one image toolbar tool
    Given project "SAMPLE_PROJECT" has image setting "<setting>"
    When I resolve the toolbar image tool for that project
    Then the active image tool should be "<tool>"
    And the active image tool module should define an image toolbar button
    And the static toolbar tools should not include "<other>"

    Examples:
      | setting     | tool              | other            |
      | accelerator | image-accelerator | image-markdown   |
      | markdown    | image-markdown    | image-accelerator |
