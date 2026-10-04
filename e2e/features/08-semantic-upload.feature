Feature: Semantic processing on upload (embeddings, OCR, object detection)

  Scenario: Uploaded photos are embedded for visual similarity
    Given I am signed in
    When I upload "photo.jpg" for semantic processing
    And I upload "photo-text.jpg" for semantic processing
    Then the uploaded photos are visually similar to each other

  Scenario: A portrait is face-detected with provenance
    Given I am signed in as an administrator
    And I remember the faces-by-detector counts
    When I upload "face.jpg" for semantic processing
    Then face detection on the uploaded photo settles with a detected face
    And the new faces are counted under the active detector

  Scenario: Admin reprocessing replaces semantic rows and drains the queues
    Given I am signed in as an administrator
    When I upload "photo.jpg" for semantic processing
    And I upload "photo-text.jpg" for semantic processing
    And the initial semantic processing has settled
    And I seed a detection on the uploaded text photo
    And I seed OCR text on the uploaded text photo
    And I open the admin dashboard
    When I start an embedding reprocess run
    And the embedding reprocess queue drains
    And I start an OCR reprocess run
    And the OCR reprocess queue drains
    And I start a detection reprocess run
    And the detection reprocess queue drains
    Then the seeded detection is replaced without duplicates
    And the uploaded photos are visually similar to each other
    And the admin page shows the last embedding reprocess run
