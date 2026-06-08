Feature: Content entry management

  Background:
    Given the sample Astro project fixture

  Scenario: Scan includes empty directories
    When I scan the sample project
    Then the response status should be 200
    And the response JSON should include "directories"

  Scenario: Create an empty folder and rescan
    When I create folder "draft-posts" in "src/content"
    Then the response status should be 200
    When I scan the sample project
    Then the response status should be 200
    And the response JSON "directories" should include "src/content/draft-posts"
