Feature: Backups

  Scenario: A full backup uploads every photo and appears in status and overview
    Given I am signed in
    And I upload two photos for backup through the API
    When an administrator backs up my account
    Then the backup result is 2 uploaded and 0 skipped
    And the backup prefix contains my user id
    And my backup status reports 2 assets
    And the backup progress for my account is idle
    And the backup overview shows my account as backed up with 2 assets

  Scenario: An incremental backup uploads only new photos
    Given I am signed in
    And I upload two photos for backup through the API
    When an administrator backs up my account
    And I upload one more photo for backup through the API
    And an administrator backs up my account again
    Then the backup result is 1 uploaded and 2 skipped
    When an administrator backs up my account again
    Then the backup result is 0 uploaded and 3 skipped

  Scenario: Backups keep users isolated from each other
    Given I am signed in
    And I upload one photo for backup through the API
    And a second user with one photo is registered
    When an administrator backs up my account
    Then the other user's backup status shows no backup
    When an administrator backs up the other user's account
    Then the other user's backup status reports 1 assets
    And my backup status reports 1 assets
    And my backup status is unchanged since my backup

  Scenario: Backing up all users serially backs up every seeded user
    Given two users each with one photo are registered
    When an administrator backs up every user serially
    Then both users show as backed up in the overview
    And an administrator sees the backups table with a Back up all button
