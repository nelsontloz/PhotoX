Feature: Viewing a photo

  Scenario: Clicking a thumbnail opens the viewer
    Given I am signed in
    And I uploaded "photo.jpg"
    When I click the photo thumbnail
    Then the viewer is open on that photo
    And the large preview is loaded
    When I press Escape
    Then the viewer is closed and the timeline is visible
