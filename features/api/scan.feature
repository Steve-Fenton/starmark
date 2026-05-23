Feature: Project scanning

  Background:
    Given the sample Astro project fixture

  Scenario: Scan discovers markdown files in content and pages
    When I scan the sample project
    Then the response status should be 200
    And the scan should find at least 2 markdown files
    And the scan results should include "src/content/blog/hello.md"
    And the scan results should include "src/pages/about.md"
