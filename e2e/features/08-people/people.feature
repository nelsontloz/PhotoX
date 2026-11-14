@people
Feature: People (persons built from clustered faces)

  Scenario: A fresh user sees the people empty state
    Given I am signed in
    When I open "/people"
    Then the people page shows the empty state

  @slow
  Scenario: The people page button queues clustering and a person card appears
    Given I am signed in
    When I upload "face.jpg"
    And the initial face detection has settled
    And I seed two matching faces on my latest photo
    And I open "/people"
    When I run clustering from the people page
    Then a person with 2 faces appears through the API
    And the people page shows a person card with 2 faces named "Unknown"

  @slow
  Scenario: Renaming a person persists and clearing the name restores "Unknown"
    Given I am signed in
    When I upload "face.jpg"
    And the initial face detection has settled
    And I seed two matching faces on my latest photo
    And I trigger person clustering through the API
    And a person with 2 faces appears through the API
    When I open "/people"
    And I open the first person card
    And I rename the person to "Ada"
    Then the person heading shows "Ada"
    And the person API name is "Ada"
    When I reload the person detail page
    Then the person heading shows "Ada"
    When I clear the person name in the UI
    Then the person heading shows "Unknown"
    And the person API has no name
    When I go back to the people page
    Then the people page shows a person card named "Unknown"

  @slow
  Scenario: The person detail shows the contained asset without a face box overlay
    Given I am signed in
    When I upload "face.jpg"
    And the initial face detection has settled
    And I seed two matching faces on my latest photo
    And I trigger person clustering through the API
    And a person with 2 faces appears through the API
    When I open "/people"
    And I open the first person card
    Then the person detail shows one asset without a face box overlay
    And the person detail shows a "Today" day header
    When I go back to the people page
    Then the people page shows a person card named "Unknown"
