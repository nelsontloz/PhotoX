@faces
Feature: Admin face detection and face reprocessing

  Scenario: Reprocessing all faces records a run and drains the queue
    Given I am signed in as an administrator
    And I uploaded "photo.jpg"
    And the initial face detection has settled
    And I seed a face on that photo
    And I open the admin dashboard
    When I start a face reprocess run
    Then the face reprocess reports queued jobs for every photo
    And the face reprocess queue drains
    And the seeded face is gone after the reprocess
    And the admin page shows the last face reprocess run

  Scenario: Reclustering faces reports the outcome
    Given I am signed in as an administrator
    And I seed two matching faces on my latest photo
    And I open the admin dashboard
    When I recluster face users
    Then the admin page confirms the recluster outcome
    And the seeded faces are grouped into a person
