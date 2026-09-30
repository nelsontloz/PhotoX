Feature: Uploading a photo makes it visible in the timeline

  Scenario: An uploaded photo appears with its thumbnail
    Given I am signed in
    When I upload "photo.jpg"
    Then the timeline shows exactly one item
    And its thumbnail image finishes loading
