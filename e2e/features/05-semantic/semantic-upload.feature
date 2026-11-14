Feature: Semantic processing on upload (embeddings, object detection)

  Scenario: Uploaded photos are embedded for visual similarity
    Given I am signed in
    When I upload "photo.jpg" for semantic processing
    And I upload "photo-text.jpg" for semantic processing
    Then the uploaded photos are visually similar to each other
