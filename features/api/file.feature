Feature: File read and write

  Background:
    Given the sample Astro project fixture

  Scenario: Read and update a markdown file
    Given the markdown file "src/content/blog/hello.md"
    When I read that file via the API
    Then the response status should be 200
    And the file body should contain "Hello from the sample Astro project"
    When I save "Updated by Cucumber" as the file body
    Then the response status should be 200
    And the file on disk should contain "Updated by Cucumber"
