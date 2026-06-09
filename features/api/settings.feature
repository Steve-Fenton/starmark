@settings
Feature: User settings

  Scenario: Settings endpoint requires a project
    When I request GET "/api/settings"
    Then the response status should be 400

  Scenario: Settings endpoint returns defaults for a project
    When I request GET "/api/settings?project=SAMPLE_PROJECT"
    Then the response status should be 200
    And the response JSON should include "settings"
    And the response JSON settings "images" should be "accelerator"
    And the response JSON settings "mediaDir" should be "public/img"
    And the response JSON settings "contentDateField" should be "modDate"
    And the response JSON settings "siteType" should be "astro-accelerator"

  Scenario: Settings can be updated for a project
    When I request PUT "/api/settings" with JSON:
      """
      {"project":"SAMPLE_PROJECT","settings":{"images":"markdown","mediaDir":"public/docs/img","contentDateField":"updateDate"}}
      """
    Then the response status should be 200
    And the response JSON settings "images" should be "markdown"
    And the response JSON settings "mediaDir" should be "public/docs/img"
    And the response JSON settings "contentDateField" should be "updateDate"

  Scenario: Media folder paths are stored relative to the project root
    When I request PUT "/api/settings" with JSON:
      """
      {"project":"SAMPLE_PROJECT","settings":{"mediaDir":"hugo/static"}}
      """
    Then the response status should be 200
    And the response JSON settings "mediaDir" should be "hugo/static"

  Scenario: A blank content date field disables auto-update
    When I request PUT "/api/settings" with JSON:
      """
      {"project":"SAMPLE_PROJECT","settings":{"contentDateField":""}}
      """
    Then the response status should be 200
    And the response JSON settings "contentDateField" should be ""

  Scenario: Site type can be updated for a project
    When I request PUT "/api/settings" with JSON:
      """
      {"project":"SAMPLE_PROJECT","settings":{"siteType":"hugo","mediaDir":"static"}}
      """
    Then the response status should be 200
    And the response JSON settings "siteType" should be "hugo"
    And the response JSON settings "mediaDir" should be "static"

  Scenario: Settings are stored per project
    When I request PUT "/api/settings" with JSON:
      """
      {"project":"SAMPLE_PROJECT","settings":{"images":"markdown","mediaDir":"public/docs/img"}}
      """
    And I request PUT "/api/settings" with JSON:
      """
      {"project":"OTHER_PROJECT","settings":{"images":"accelerator","mediaDir":"public/img"}}
      """
    And I request GET "/api/settings?project=SAMPLE_PROJECT"
    Then the response JSON settings "images" should be "markdown"
    And the response JSON settings "mediaDir" should be "public/docs/img"
    When I request GET "/api/settings?project=OTHER_PROJECT"
    Then the response JSON settings "images" should be "accelerator"
    And the response JSON settings "mediaDir" should be "public/img"
    And the response JSON settings "contentDateField" should be "modDate"
