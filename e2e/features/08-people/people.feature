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
  Scenario: The person detail shows the contained asset with a face box overlay
    Given I am signed in
    When I upload "face.jpg"
    And the initial face detection has settled
    And I seed two matching faces on my latest photo
    And I trigger person clustering through the API
    And a person with 2 faces appears through the API
    When I open "/people"
    And I open the first person card
    Then the person detail shows one asset with a face box overlay
    When I go back to the people page
    Then the people page shows a person card named "Unknown"

  @slow
  Scenario: Assigning a viewer face to a person updates the person's face count
    Given I am signed in
    When I upload "face.jpg"
    And the initial face detection has settled
    And I seed two matching faces on my latest photo
    And I trigger person clustering through the API
    And a person with 2 faces appears through the API
    When I upload "photo.jpg"
    And the initial face detection has settled
    And I seed one unassigned person face on my latest photo
    And I open my latest person photo in the viewer
    And I open the person info panel
    And I assign the viewer face to the seeded person
    Then the seeded person face is assigned to the person
    When I unassign the viewer face from the person
    Then the seeded person face is unassigned from the person

  @slow
  Scenario: Persons are isolated between users
    Given I am signed in
    When I upload "face.jpg"
    And the initial face detection has settled
    And I seed two matching faces on my latest photo
    And I trigger person clustering through the API
    And a person with 2 faces appears through the API
    Then another user cannot get the person
    And another user cannot rename the person

  @slow
  Scenario: Clearing a person name through the API
    Given I am signed in
    When I upload "face.jpg"
    And the initial face detection has settled
    And I seed two matching faces on my latest photo
    And I trigger person clustering through the API
    And a person with 2 faces appears through the API
    When I rename the person to "Grace" through the API
    Then the person is named "Grace" through the API
    When I clear the person name through the API
    Then the person has no name through the API

  Scenario: The person cluster endpoint accepts a run
    Given I am signed in
    When I trigger person clustering through the API
    Then the response status is 202

  @slow
  Scenario: The person list pages over two distinct clusters
    Given I am signed in
    When I upload "photo.jpg"
    And the initial face detection has settled
    And I seed two distinct person clusters on my latest photo
    And I trigger person clustering through the API
    And two persons with 2 faces each appear through the API
    Then the person list pages with a limit of 1
