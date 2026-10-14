Feature: Backup orphans, restore and delete

  Scenario: Orphaned backups show the deleted row with filter and search
    Given a backed-up user with one photo is registered as the backup orphan victim
    And an administrator opens the backups tab
    When I filter backups by "All"
    Then the orphan victim row shows the deleted orphan actions
    When I filter backups by "Active"
    Then the orphan victim is hidden from the backups table
    When I filter backups by "Deleted"
    Then the orphan victim row shows the deleted orphan actions
    When I filter backups by "All"
    And I search backups for the orphan victim
    Then the orphan victim row shows the deleted orphan actions

  Scenario: Restoring an orphaned backup brings the account back
    Given a backed-up user with one photo is registered as the backup orphan victim
    And an administrator opens the backups tab
    And I search backups for the orphan victim
    When I restore the orphan victim through the confirmation dialog
    Then the orphan victim restore toast names the restored account
    And the orphan victim row shows as active with backup enabled

  Scenario: Deleting a live backup keeps the account and library
    Given a backed-up user with one photo is registered for live backup deletion
    And an administrator opens the backups tab
    And I search backups for the live backup user
    When I open the delete backup dialog for that live user
    Then the live delete dialog shows the prefix and counts
    And the backup delete confirm stays disabled until DELETE is typed exactly
    And cancelling or escaping the live delete dialog issues no backup delete request
    When I confirm live backup deletion with typed DELETE
    Then the live backup row shows no backup
    And the live account and library stay intact
    And a fresh backup recreates the live backup

  Scenario: Deleting an orphaned backup keeps the account deleted
    Given a backed-up user with one photo is registered as the backup orphan victim
    And an administrator opens the backups tab
    When I filter backups by "Deleted"
    And I search backups for the orphan victim
    And I open the delete backup dialog for the orphan victim
    Then the orphan delete dialog shows the prefix and counts
    When I confirm orphan backup deletion with typed DELETE
    Then the orphan backup row is gone and its status is missing
    And the orphan victim account stays deleted

  Scenario: Backup-all skips deleted orphans
    Given an active backed-up user and a deleted backed-up orphan are registered
    And an administrator opens the backups tab
    When I run backup-all from the backups tab
    Then backup-all backs up the active user and skips the deleted orphan
