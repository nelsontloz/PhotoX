Feature: Admin user deletion

  Scenario: Every row has a Delete action but the admin cannot delete themselves
    Given I am signed in as the seeded administrator
    And a regular user is registered for the admin list
    When I can open the admin dashboard
    Then the users table shows an Actions column with a Delete button for the listed user
    And my own admin row disables Delete with the self-delete guard

  Scenario: The delete dialog gates confirmation behind typed DELETE
    Given I am signed in as the seeded administrator
    And a regular user with one photo is registered for deletion
    When I can open the admin dashboard
    And I open the delete dialog for that user
    Then the delete dialog shows the identity card, impact counts and the backup-kept note
    And the delete confirm stays disabled until DELETE is typed exactly

  Scenario: Confirming deletion removes the user and updates the list
    Given I am signed in as the seeded administrator
    And a regular user with one photo is registered for deletion
    When I can open the admin dashboard
    And I search the users list for that user
    Then the users footer shows a single registered user
    When I confirm deletion of that user while the delete response is delayed
    Then the delete dialog is closed
    And the users list no longer matches the deleted user

  Scenario: A delete that races another removal surfaces the error and keeps the dialog open
    Given I am signed in as the seeded administrator
    And a regular user with one photo is registered for deletion
    When I can open the admin dashboard
    And I open the delete dialog for that user
    And that user is removed through the API while the dialog is open
    And I confirm deletion of that user
    Then the missing-user message is shown and the dialog stays open

  Scenario: Deleting the last admin is rejected with 409
    Given I am signed in as the seeded administrator
    And a regular user is registered for the admin list
    When an admin delete is attempted on the last admin with an API setup token
    Then the last-admin guard rejects with 409 verbatim
    And self-deletion through the API is rejected with 403 verbatim

  Scenario: Deleting a user wipes the library but keeps the S3 backup and spares siblings
    Given I am signed in as the seeded administrator
    And a victim user with a full library and backup is registered
    And a sibling user with a full library and backup is registered
    When I can open the admin dashboard
    And I delete the victim user through the confirmation dialog
    Then the victim deletion reaches a terminal state
    And the victim library is gone but the victim backup is kept
    And the sibling library and backup are untouched
    And the backups tab keeps the sibling row and stays usable

  Scenario: A deleted backup surfaces as an orphan while the sibling stays active
    Given I am signed in as the seeded administrator
    And a victim user with a full library and backup is registered
    And a sibling user with a full library and backup is registered
    When I can open the admin dashboard
    And I delete the victim user through the confirmation dialog
    Then the victim deletion reaches a terminal state
    When I open the backups tab
    And I filter backups to deleted accounts
    Then the victim backup shows as a deleted user with a restore action
    When I filter backups to active accounts
    Then the sibling backup stays active with a working backup action

  Scenario: Restoring an already-restored backup reports the conflict and shows the live account
    Given I am signed in as the seeded administrator
    And a victim user with a full library and backup is registered
    When I can open the admin dashboard
    And I delete the victim user through the confirmation dialog
    Then the victim deletion reaches a terminal state
    When I open the backups tab
    And I filter backups to deleted accounts
    Then the victim backup shows as a deleted user with a restore action
    When the victim backup is restored through the API
    And I restore the victim backup through the confirmation dialog
    Then the already-restored conflict is shown and the victim account is live again

  Scenario: Restoring onto a re-registered email falls back to a restored- address
    Given I am signed in as the seeded administrator
    And a victim user with a full library and backup is registered
    When I can open the admin dashboard
    And I delete the victim user through the confirmation dialog
    Then the victim deletion reaches a terminal state
    When the victim email is re-registered by a new user
    And I open the backups tab
    And I restore the victim backup through the confirmation dialog
    Then the restore toast names the fallback address
    And the fallback account signs in with the old password while the re-registered account keeps the email

  Scenario: Merging a deleted user's backup into the re-registered account
    Given I am signed in as the seeded administrator
    And a victim user with a full library and backup is registered
    When I can open the admin dashboard
    And I delete the victim user through the confirmation dialog
    Then the victim deletion reaches a terminal state
    When the victim email is re-registered by a new user
    And I open the backups tab
    And I search backups for the victim email
    Then the matched backup row shows the previous-account merge action
    When I merge the matched backup into the live account
    Then the live account owns the backup library
    And the source backup is gone
    And a second merge is rejected

  Scenario: Deleting and restoring repeatedly still wipes the account and regenerates derivatives
    Given I am signed in as the seeded administrator
    And a victim user with a full library and backup is registered
    When I can open the admin dashboard
    And I delete the victim user through the confirmation dialog
    Then the victim deletion reaches a terminal state
    When the victim backup is restored through the API
    And I can open the admin dashboard
    And I delete the victim user through the confirmation dialog
    Then the victim deletion reaches a terminal state
    And the users list no longer matches the deleted user
    When the victim backup is restored through the API
    Then the victim's photo derivatives regenerate
