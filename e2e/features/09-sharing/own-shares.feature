Feature: Managing my public share links

  Scenario: A fresh account sees the empty shared links state
    Given I am signed in
    When I open "/shared"
    Then the share list shows the empty state

  Scenario: Creating an album share from the album page lists it on the shared page
    Given I am signed in
    When I upload "photo.jpg"
    And I prepare an album share target with the uploaded photo
    And I open the album detail for that share target
    When I create an album share from the album options
    Then the album page confirms the share link was copied
    And the shares API lists that share with a token
    When I open "/shared"
    Then the share list shows an album share entry

  Scenario: Creating an asset share from the viewer lists it on the shared page
    Given I am signed in
    When I upload "photo.jpg"
    And I click the photo thumbnail
    When I create an asset share from the viewer
    Then the shares API lists that share with a token
    When I open "/shared"
    Then the share list shows an asset share entry

  Scenario: Revoking a share from the shared page makes its link stop working
    Given I am signed in
    When I upload "photo.jpg"
    And I create an asset share for the uploaded photo
    When I open "/shared"
    Then the share list shows an asset share entry
    When I revoke that share from the share list
    Then the share list no longer lists that share
    And the shares API does not list that share
    When an anonymous client calls the public share API for that share
    Then the response status is 404

  Scenario: A trashed photo's share disappears while its album share remains
    Given I am signed in
    When I upload "photo.jpg"
    And I prepare an album share target with the uploaded photo
    And I create an album share for that share target
    And I create an asset share for the uploaded photo
    When I trash the uploaded share photo via the API
    And I open "/shared"
    Then the share list shows only the album share

  Scenario: Share creation rejects zero or two targets
    Given I am signed in
    When I call "POST /api/v1/shares" with my token
    Then the response status is 400
    When I submit a share request with both an asset and an album id
    Then the response status is 400

  Scenario: Requesting the same asset share twice is idempotent
    Given I am signed in
    When I upload "photo.jpg"
    And I create an asset share for the uploaded photo
    Then the response status is 201
    When I create an asset share for the uploaded photo again
    Then both share requests returned the same share id and token
    And the shares API lists exactly one share entry

  Scenario: Shares are isolated between users
    Given I am signed in
    And a second user registers for share testing
    When I upload "photo.jpg"
    And I create an asset share for the uploaded photo
    When the second user creates an asset share for their own uploaded photo
    Then the second user's shares API lists only their own share
    When the second user attempts to revoke the first user's share
    Then the response status is 404

  Scenario: A foreign album cannot be shared
    Given I am signed in
    And a second user registers for share testing
    When I upload "photo.jpg"
    And I prepare an album share target with the uploaded photo
    When the second user requests a share of the first user's album target
    Then the response status is 404

  Scenario: A share of a trashed photo stops resolving
    Given I am signed in
    When I upload "photo.jpg"
    And I create an asset share for the uploaded photo
    When I trash the uploaded share photo via the API
    When an anonymous client calls the public share API for that share
    Then the response status is 404
