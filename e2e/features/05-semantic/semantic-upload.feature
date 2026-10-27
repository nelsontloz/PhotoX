Feature: Semantic processing on upload (embeddings, object detection)

  Scenario: Uploaded photos are embedded for visual similarity
    Given I am signed in
    When I upload "photo.jpg" for semantic processing
    And I upload "photo-text.jpg" for semantic processing
    Then the uploaded photos are visually similar to each other

  Scenario: A portrait is face-detected on upload
    Given I am signed in as an administrator
    When I upload "face.jpg" for semantic processing
    Then face detection on the uploaded photo settles with a detected face
    And the uploaded photo records its detected face count

  Scenario: Admin reprocessing replaces semantic rows and drains the queues
    Given I am signed in as an administrator
    When I upload "photo.jpg" for semantic processing
    And I upload "photo-text.jpg" for semantic processing
    And the initial semantic processing has settled
    And I seed a detection on the uploaded text photo
    And I open the admin dashboard
    When I start an embedding reprocess run
    And the embedding reprocess queue drains
    And I start a detection reprocess run
    And the detection reprocess queue drains
    Then the seeded detection is replaced without duplicates
    And the uploaded photos are visually similar to each other
    And the admin page shows the last embedding reprocess run
