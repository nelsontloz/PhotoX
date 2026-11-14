Feature: Search page readiness and related tray
  Scenario: Viewer shows similar photos in the related tray
    Given I am signed in
    When I upload "photo.jpg" for semantic processing
    And I upload "photo-text.jpg" for semantic processing
    Then the uploaded photos are visually similar to each other
    When I open the first photo in the viewer
    Then the related tray offers similar photos
    When I expand the similar photos
    Then the tray lists the similar photo count
