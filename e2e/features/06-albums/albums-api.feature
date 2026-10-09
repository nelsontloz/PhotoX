Feature: Album API edges

  Scenario: Albums are isolated per user
    Given I am signed in
    And I created an album via the API named "Private album"
    And I uploaded an album photo
    And I registered a second album user
    When I add my album photo to the album
    Then the response status is 201
    When the other album user requests my album
    Then the response status is 404
    When the other album user renames my album
    Then the response status is 404
    When the other album user deletes my album
    Then the response status is 404
    When the other album user requests my album's photos
    Then the response status is 404
    When the other album user adds their own photo to my album
    Then the response status is 404
    And the album asset count is 1

  Scenario: Adding another user's photo to an album is rejected
    Given I am signed in
    And I created an album via the API named "Guarded album"
    And I registered a second album user
    And the other album user uploaded an album photo
    When I add the other album user's photo to my album
    Then the response status is 404
    And the album asset count is 0

  Scenario: Adding a trashed photo to an album is rejected
    Given I am signed in
    And I created an album via the API named "Trash-guarded album"
    And I uploaded an album photo
    When I trash my album photo
    Then the response status is 204
    When I add my trashed album photo to the album
    Then the response status is 404
    And the album asset count is 0

  Scenario: Adding the same photo twice keeps a single album item
    Given I am signed in
    And I created an album via the API named "Twice album"
    And I uploaded an album photo
    When I add my album photo to the album
    And I add my album photo to the album again
    Then the album asset count is 1

  Scenario: Album list pagination is newest first
    Given I am signed in
    And I created an album via the API named "First album"
    And I created an album via the API named "Second album"
    And I created an album via the API named "Third album"
    When I list my albums with limit 2 and offset 0
    Then the listed albums in order are "Third album, Second album"
    When I list my albums with limit 2 and offset 2
    Then the listed albums in order are "First album"

  Scenario: Album photos are listed by added time, newest first
    Given I am signed in
    And I created an album via the API named "Ordered album"
    And I uploaded two album photos
    When I add my album photo to the album
    And I add my second album photo to the album
    Then my album lists the photos newest-added first

  Scenario: Creating an album without a name is rejected
    Given I am signed in
    When I create an album without a name
    Then the response status is 400
