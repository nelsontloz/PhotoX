Feature: Admin account editing

  Scenario: The users table offers an Edit action and the dialog opens with the account's current values
    Given an administrator session is available for account editing
    And a regular account is registered for the edit flow
    When the account-editing admin opens the users tab
    And the account-editing admin searches the users list for that account
    Then the users table offers an enabled Edit action for that account
    When the account-editing admin opens the edit dialog for that account
    Then the edit dialog is prefilled with the account's current name and email and an empty password field

  Scenario: Saving a new name and email updates the account and the list
    Given an administrator session is available for account editing
    And a regular account is registered for the edit flow
    When the account-editing admin opens the users tab
    And the account-editing admin saves a new name and email for that account
    Then the edit dialog closes after a successful save
    And the account edit toast reports the new name
    And the users list shows the updated name and email

  Scenario: The edited account signs in with the new address and the old one no longer works
    Given an administrator session is available for account editing
    And a regular account is registered for the edit flow
    When the account-editing admin changes that account's email through the admin API
    Then the edited account signs in with the new address
    And the old address no longer signs in
    And the edit response reports no backup to move

  Scenario: The S3 backup moves to the new address immediately
    Given an administrator session is available for account editing
    And a regular account is registered for the edit flow
    And that account has an S3 backup taken through the admin API
    When the account-editing admin opens the users tab
    And the account-editing admin changes that account's email through the edit dialog
    Then the account edit toast confirms the S3 backup moved
    And the account's S3 backup is reported at the new address

  Scenario: A failed move surfaces a warning with a retry that can clear it
    Given an administrator session is available for account editing
    And a regular account is registered for the edit flow
    When the account-editing admin opens the users tab
    And the account-editing admin triggers a failed backup move for that account
    Then the backup warning box reports the storage error with a Retry move action
    When the account-editing admin retries the backup move
    Then the backup warning box is cleared

  Scenario: A role change through the API is rejected
    Given an administrator session is available for account editing
    And a regular account is registered for the edit flow
    When the account-editing admin attempts a role change through the admin API
    Then the role change is rejected as a bad request
    And the account's role is unchanged
