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
