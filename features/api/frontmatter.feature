Feature: Frontmatter parsing

  Scenario: Parse frontmatter with a pipe block scalar
    Given the markdown file "src/content/blog/multiline.md"
    When I read that file via the API
    Then the response status should be 200
    And the response body should contain "description: |"
    And the response body should contain "multi-line string using a pipe"

  Scenario: Parse Hugo-style frontmatter with a pipe block scalar
    Given the markdown file "src/content/blog/hugo-style.md"
    When I read that file via the API
    Then the response status should be 200
    And the response body should contain "summary: |"
    And the response body should contain "context engineering"
