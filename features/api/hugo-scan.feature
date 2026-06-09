Feature: Hugo project scanning

  Background:
    Given the sample Hugo project fixture

  Scenario: Scan discovers markdown files in hugo/content when site type is Hugo
    When I set the project site type to "hugo"
    And I scan the sample Hugo project
    Then the response status should be 200
    And the scan should find at least 1 markdown files
    And the scan results should include "hugo/content/blog/hello.md"

  Scenario: Hugo content is ignored when site type is Astro
    When I set the project site type to "astro"
    And I scan the sample Hugo project
    Then the response status should be 200
    And the scan results should not include "hugo/content/blog/hello.md"
